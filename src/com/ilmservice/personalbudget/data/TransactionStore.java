package com.ilmservice.personalbudget.data;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import javax.annotation.PostConstruct;
import javax.ejb.Stateless;
import javax.enterprise.context.RequestScoped;
import javax.enterprise.inject.Default;
import javax.inject.Inject;
import javax.inject.Singleton;

import com.google.protobuf.ByteString;
import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Views.DateRangeFilter;
import com.ilmservice.personalbudget.protobufs.Views.Filter;
import com.ilmservice.personalbudget.protobufs.Views.TransactionList;
import com.ilmservice.personalbudget.protobufs.Views.UnsortedTransaction;
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
		System.out.println("TransactionStore configuring     ");
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
		Transaction existing = null;
		try {
			existing = transactionsByDate.query()
					.atKey(new DateIDKey(builder.getDate(), builder.getId())).firstOrNull();
		} catch (IOException e) {
			e.printStackTrace();
		}
		if(existing == null) {
			return transactions.put(builder.build());
		} else {
			return existing;
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
					ArrayList<Transaction>::add, 
					ArrayList<Transaction>::addAll
				)
			).build();
	}
	
	@Override
	public TransactionList.Builder list(TransactionList query) {
		List<Filter> filters = query.getFiltersList();
		IRepositoryQuery<DateIDKey, Transaction> repoQuery = null; 
		if(!filters.isEmpty()) {
			Optional<Filter> dateRange = filters.stream()
					.filter((filter) -> filter.hasDateRangeFilter()).findFirst();
			if(dateRange.isPresent()) {
				DateRangeFilter dateRangeFilter = dateRange.get().getDateRangeFilter();
				repoQuery = transactionsByDate.query().range(
						new DateIDKey(dateRangeFilter.getStart(), ByteString.EMPTY), 
						new DateIDKey(dateRangeFilter.getEnd(), ByteString.EMPTY)
					);
			}
		}
		if(repoQuery != null) {
			repoQuery.limit(10);
			
			TransactionList.Builder builder = TransactionList.newBuilder(query);
			builder.addAllTransactions(repoQuery.toArray());
			return builder;
		}
		return TransactionList.newBuilder(query);
	}
	
	@Override
	public Transaction getUnsortedTransaction() {
		try {
			return transactionsByCategory.query().range(
					new CategoryDateIDKey(0, 0, ByteString.EMPTY), 
					new CategoryDateIDKey(1, 0, ByteString.EMPTY)
				)
			.where((result) -> result.getCategoryId() == 0)
			.limit(1)
			.firstOrNull();
		} catch (IOException e) {
			e.printStackTrace();
		}
		return null;
	}
	
	@Override
	public Map<Integer, Integer> aggregate() {
		try {
			return transactionsByCategory.query().range(
					new CategoryDateIDKey(0, 0, ByteString.EMPTY), 
					new CategoryDateIDKey(1, 0, ByteString.EMPTY)
				)
			.where((result) -> result.getCategoryId() == 0)
			.limit(1)
			.firstOrNull();
		} catch (IOException e) {
			e.printStackTrace();
		}
		return null;
	}
}
