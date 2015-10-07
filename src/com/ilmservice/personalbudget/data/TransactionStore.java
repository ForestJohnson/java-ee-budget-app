package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Stream;

import javax.annotation.PostConstruct;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.ByteString;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Views.DateRangeFilter;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.repository.IDbScope;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;
import com.ilmservice.repository.IRepository.IRepositoryQuery;
import com.ilmservice.repository.TransactionPerRequest;

@Default
@Singleton
public class TransactionStore implements ITransactionStore {
	
	@Inject 
	@TransactionPerRequest
	private IDbScope scope;
	
	@Inject 
	private IRepository<Transaction> transactions;
	
	private IRepositoryIndex<DateIDKey, Transaction> transactionsByDate;
	private IRepositoryIndex<CategoryDateIDKey, Transaction> transactionsByCategory;
	private MessageDigest sha;
	
	TransactionStore() throws NoSuchAlgorithmException {
		sha = MessageDigest.getInstance("SHA");
	}
	
	public class DateIDKey {
		public final long dateMs;
		public final ByteString id;
		
		public DateIDKey (long dateMs, ByteString id) {
			this.dateMs = dateMs;
			this.id = id;
		}
	}
	public class CategoryDateIDKey {
		public final int categoryId;
		public final long dateMs;
		public final ByteString id;
		
		public CategoryDateIDKey (int categoryId, long dateMs, ByteString id) {
			this.categoryId = categoryId;
			this.dateMs = dateMs;
			this.id = id;
		}
	}
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionStore configuring                                  ");
		transactions.configure( 
			scope,
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionStore indexes ");
					
					transactionsByDate = transactions.configureIndex(
						Indexes.TransactionsByDate.getValue(),
						false,
						(k) -> Transaction.newBuilder().setDate(k.dateMs).setId(k.id).build(),
						(v) -> new DateIDKey(v.getDate(), v.getId()),
						(k) -> {
							byte[] idByteArray = new byte[k.id.size()];
							k.id.copyTo(idByteArray,0);
							return ByteBuffer.allocate(8+k.id.size())
									.putLong(k.dateMs)
									.put(idByteArray)
									.array();
						}
					);
					
					transactionsByCategory = transactions.configureIndex(
						Indexes.TransactionsByCategory.getValue(),
						true,
						(k) -> Transaction.newBuilder()
								.setCategoryId(k.categoryId).setDate(k.dateMs).setId(k.id).build(),
						(v) -> new CategoryDateIDKey(v.getCategoryId(), v.getDate(), v.getId()),
						(k) -> {
							byte[] idByteArray = new byte[k.id.size()];
							k.id.copyTo(idByteArray,0);
							return ByteBuffer.allocate(4+8+k.id.size())
									.putInt(k.categoryId)
									.putLong(k.dateMs)
									.put(idByteArray)
									.array();
						}
					);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public Transaction post(Transaction.Builder builder) throws IOException {
		byte[] idBytes = sha.digest(builder.build().toByteArray());
		builder.setId(ByteString.copyFrom(idBytes));
		Optional<Transaction> existing = Optional.empty();
		try {
			existing = transactionsByDate.get(new DateIDKey(builder.getDate(), builder.getId()));
		} catch (IOException e) {
			e.printStackTrace();
			return builder.build();
		}
		if(!existing.isPresent()) {
			return transactions.put(builder.build());
		} else {
			return existing.get();
		}
	}
	
	@Override
	public void put(Transaction transaction) throws IOException {
		transactions.put(transaction);
	}
	
	@Override
	public TransactionList postAll(TransactionList transactionList) {
		return TransactionList.newBuilder().addAllTransactions(
				transactionList.getTransactionsList().stream().map((transaction) -> {
					try {
						return this.post(Transaction.newBuilder(transaction));
					} catch (Exception e) {
						e.printStackTrace();
						return null;
					}
				}).collect(
					ArrayList<Transaction>::new, 
					List<Transaction>::add, 
					List<Transaction>::addAll
				)
			).build();
	}
	
	@Override
	public <R> R withStream(List<Filter> filters, boolean descending, Function<Stream<Transaction>, R> action) {
		
		IRepositoryQuery<DateIDKey, Transaction> repoQuery = getQueryFromFilters(filters, descending);
		
		return repoQuery.withStream(action);
	}
	
	@Override
	public Transaction getUnsortedTransaction() {
		return transactionsByCategory.query().range(
				new CategoryDateIDKey(0, 0, ByteString.EMPTY), 
				new CategoryDateIDKey(1, 0, ByteString.EMPTY)
			)
		.withStream(
			(s) -> s.filter((t) -> t.getCategoryId() == 0)
			.findFirst()
			.orElseGet(() -> Transaction.getDefaultInstance())
		);
		
	}
	
	@Override
	public Map<Integer, Integer> aggregate(List<Filter> filters) {
		return getQueryFromFilters(filters, false)
		.withStream(
			(s) -> s.collect(
					HashMap<Integer, Integer>::new, 
					(map, t) -> map.compute(
							t.getCategoryId(), 
							(k,v) -> v == null ? t.getCents() : v + t.getCents()
						), 
					(a,b) -> b.keySet().stream().forEach( (bk) -> 
								a.compute(bk, (ak, av) -> av == null ? b.get(bk) : av + b.get(bk))
						)
				)
		);
	}
	
	private IRepositoryQuery<DateIDKey, Transaction> getQueryFromFilters(List<Filter> filters, boolean descending) {
		IRepositoryQuery<DateIDKey, Transaction> repoQuery = transactionsByDate.query(); 
		if(descending) {
			repoQuery.descending();
		}
		if(!filters.isEmpty()) {
			Optional<Filter> dateRange = filters.stream()
					.filter((filter) -> filter.hasDateRangeFilter()).findFirst();
			if(dateRange.isPresent()) {
				DateRangeFilter dateRangeFilter = dateRange.get().getDateRangeFilter();
				repoQuery.range(
						dateRangeFilter.getStart() != 0 
							? new DateIDKey(dateRangeFilter.getStart(), ByteString.EMPTY) : null, 
						dateRangeFilter.getEnd() != 0 
							? new DateIDKey(dateRangeFilter.getEnd(), ByteString.EMPTY) : null
					);
			}
		}
		return repoQuery;
	}
}
