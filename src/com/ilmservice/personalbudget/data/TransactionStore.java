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
	
	private IRepositoryIndex<ByteString, Transaction> transactionsById;
	private IRepositoryIndex<Long, Transaction> transactionsByDate;
	private MessageDigest sha;
	
	TransactionStore() throws NoSuchAlgorithmException {
		sha = MessageDigest.getInstance("SHA");
	}
	
	@PostConstruct
	public void configure() {
		System.out.println("TransactionStore configuring");
		transactions.configure( 
			scope,
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray(),
			() -> {
				try {
					System.out.println("TransactionStore indexes ");
					transactionsById = transactions.configureIndex(
						Indexes.TransactionsById.getValue(),
						(k) -> Transaction.newBuilder().setId(k).build(),
						(v) -> v.getId(),
						(k) -> {
							byte[] result = new byte[k.size()];
							k.copyTo(result,0);
							return result;
						}
					);
					transactionsByDate = transactions.configureIndex(
							Indexes.TransactionsByDate.getValue(),
							(k) -> Transaction.newBuilder().setDate(k).build(),
							(v) -> v.getDate(),
							(k) -> ByteBuffer.allocate(8).putLong(k).array()
						);
				} catch (Exception e) {
					e.printStackTrace();
				}
			}
		);
					
	}
	
	@Override
	public Transaction put(Transaction.Builder builder) {
		byte[] idBytes = sha.digest(builder.build().toByteArray());
		builder.setId(ByteString.copyFrom(idBytes));
		Transaction existing = null;
		try {
			existing = transactionsById.query().atKey(ByteString.copyFrom(idBytes)).firstOrNull();
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
	public TransactionList putAll(TransactionList transactionList) {
		return TransactionList.newBuilder().addAllTransactions(
				transactionList.getTransactionsList().stream().map((transaction) -> {
					return this.put(Transaction.newBuilder(transaction));
				}).collect(
					() -> new ArrayList<Transaction>(), 
					(list, transaction) -> { list.add(transaction); }, 
					(a, b) -> new ArrayList<Transaction>()
				)
			).build();
	}
	
	@Override
	public TransactionList list(TransactionList query) {
		List<Filter> filters = query.getFiltersList();
		IRepositoryQuery<Long, Transaction> repoQuery = null; 
		if(!filters.isEmpty()) {
			Optional<Filter> dateRange = filters.stream()
					.filter((filter) -> filter.hasDateRangeFilter()).findFirst();
			if(dateRange.isPresent()) {
				DateRangeFilter dateRangeFilter = dateRange.get().getDateRangeFilter();
				repoQuery = transactionsByDate.query().range(dateRangeFilter.getStart(), dateRangeFilter.getEnd());
			}
		}
		if(repoQuery != null) {
			repoQuery.limit(10);
			
			TransactionList.Builder builder = TransactionList.newBuilder(query);
			builder.addAllTransactions(repoQuery.toArray());
			return builder.build();
		}
		return query;
	}
	
//	public Transaction test(int id) {
//		Transaction modified = null;
//		try {
//			System.out.println("TransactionStore testing  ");
//			Transaction result = transactionsById.query().atKey(id).firstOrDefault();
//			System.out.println(result.toString());
//			modified = Transaction.newBuilder(result)
//									.setDescription(result.getDescription() + " :)  ").build();
//			
//			System.out.println(modified.toString());
//			transactions.put(modified);
//			
//		} catch (IOException e) {
//			System.out.println("TransactionStore testing failed ");
//			// TODO Auto-generated catch block
//			e.printStackTrace();
//		}
//		return modified;
//	}
}
