package com.ilmservice.personalbudget.data;

import java.nio.ByteBuffer;

import javax.annotation.PostConstruct;
import javax.inject.Inject;

import com.ilmservice.personalbudget.protobufs.Data.Transaction;
import com.ilmservice.personalbudget.protobufs.Events.Event;
import com.ilmservice.repository.IRepository;
import com.ilmservice.repository.IRepository.IRepositoryIndex;

public class TransactionStore implements ITransactionStore {
	
	@Inject private IRepository<Transaction> transactions;
	private IRepositoryIndex<Integer, Transaction> transactionsById;
	
	@PostConstruct
	public void configure() {
		transactions.configure( 
			(bytes) -> Transaction.parseFrom(bytes),
			(transaction) -> transaction.toByteArray()
		);
		
		transactionsById = transactions.configureIndex(
			Indexes.TransactionsById.getValue(),
			(k) -> Transaction.newBuilder().setId(k).build(),
			(v) -> v.getId(),
			(k) -> ByteBuffer.allocate(4).putInt(k).array()
			
		);
	}
}
